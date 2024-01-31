const path = require('node:path');
const {createInterface} = require('node:readline');
const {createReadStream, watch} = require('node:fs');
const {createSocket} = require('node:dgram');
const {exec: _exec} = require('node:child_process');
const {promisify} = require('node:util');
const {readdir} = require('node:fs/promises');
const {setTimeout} = require('node:timers/promises');

const exec = promisify(_exec);

const QM_PATH = process.env.QM_PATH || '/usr/sbin/qm';
const VM_CONFIG_DIR = process.env.VM_CONFIG_DIR || process.argv[2] || '/etc/pve/qemu-server'

const createMACTable = async dir => {
  const files = await readdir(dir, {withFileTypes: true})
    .then(r => r.filter(d => d.isFile() && d.name.endsWith('.conf')));

  const entries = await Promise.all(files.map(async f => {
    const id = Number(f.name.replace('.conf', ''));

    const fileStream = createReadStream(path.join(f.path, f.name));

    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    const results = [];

    for await (const line of rl) {
      if (line.startsWith('[')) {
        break;
      }

      let mac = /^net\d+:\s\w+=((?:[a-f0-9]{2}:){5}[a-f0-9]{2})/i.exec(line)?.[1];
      if (mac) {
        results.push([mac.toLowerCase(), id]);
      }
    }

    rl.close();
    fileStream.close();

    return results;
  }));

  return Object.fromEntries(entries.flat())
};

const createDebouncedStartVM = () => {
  const TIMEOUT = 5_000;
  const cooldowns = new Set();

  const startVM = async id => {
    if (cooldowns.has(id)) {
      return;
    }

    cooldowns.add(id);
    setTimeout(TIMEOUT).then(() => (cooldowns.delete(id)));

    console.log('Starting VM:', id);

    const toCmd = args => args.map(a => JSON.stringify(a)).join(' ');

    const _statusCmdOutput = await exec(toCmd([
      QM_PATH,
      'status',
      id
    ]));

    const statusCmdOutput = _statusCmdOutput.stdout?.trim();

    if (statusCmdOutput.endsWith('does not exist')) {
      console.error('VM', id, 'does not exist.');
      return;
    }

    if (!statusCmdOutput.startsWith('status: ')) {
      console.error('Got unexpected output for id', id, ':', statusCmdOutput.stdout);
      return;
    }

    const vmStatus = statusCmdOutput.replace('status: ', '');

    const startCommandMap = {
      stopped: [QM_PATH, 'start', id],
      suspended: [QM_PATH, 'resume', id],
    };

  if (vmStatus in startCommandMap) {
      try {
        const startOutput = await exec(toCmd(startCommandMap[vmStatus]));
        if (startOutput.stderr) {
          console.error('Error starting vm', id, ':', startOutput.stderr.trim());
          return;
        }
      } catch (err) {
        console.error('Failed to start vm', id, err.message.trim());
        return;
      }
    } else {
      console.info('Tried to start VM with unknown status:', vmStatus);
    }
  }
  startVM.isOnCooldown = id => cooldowns.has(id);

  return startVM;
}

const main = async dir => {
  let macTable;

  const reloadMACTable = () =>
    createMACTable(dir).then(table => {
      macTable = table
      console.log('Loading MAC addresses from:', dir);
      console.table(macTable);
      return macTable;
    });

  const startVM = createDebouncedStartVM();
  reloadMACTable();

  const socket = createSocket({type: 'udp4', reuseAddr: true});

  socket.on('listening', () => {
    const addr = socket.address();
    console.log('UDP socket listening on', addr.address + ':' + addr.port);
  });

  socket.on('message', msg => {
    const magic = Buffer.alloc(6, 0xff);
    const start = msg.subarray(0, 6);
    if (!start.equals(magic)) {
      return;
    }

    const mac = msg.subarray(6, 12);
    const expected = Buffer.alloc(6*16, mac);
    if (!msg.subarray(6).equals(expected)) {
      return;
    }

    const formattedMAC = mac.toString('hex').replace(/(..)/g, '$1:').slice(0, -1).toLowerCase();
    if (formattedMAC in macTable) {
      const id = macTable[formattedMAC];
      try {
        startVM(id);
      } catch (err) {
        console.error('Failed to start VM:', err);
      }
    }
  });

  watch(dir, () => {
    console.log('Detected change in PVE configs, reloading...');
    reloadMACTable();
  });

  process.on('SIGHUP', () => {
    console.log('Got SIGHUP, reloading MAC table');
    reloadMACTable();
  });

  socket.bind(9, '0.0.0.0', () => {
    socket.setBroadcast(true);
  });
};

main(VM_CONFIG_DIR).catch(console.error);
