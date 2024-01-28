# Wake-On-LAN for Proxmox VE VMs

Start a Proxmox VM by sending a wake-on-lan packet.

### Setup
> [!IMPORTANT]
> You must have Node.js installed. Any recent version should work.

1. Copy `wol.js` to `/opt/pve-wol/wol.js`
2. Copy `pve-wol.service` to `/etc/systemd/system/pve-wol.service`. Update the `ExecStart` line with your VM conf directory as needed.
3. `systemct daemon-reload`
4. `systemctl start pve-wol`
5. `systemctl enable pve-wol`
6. Test it! `wakeonlan <VM-MAC-addr>`

> [!TIP]
> The mapping table of mac address -> vm id automatically updates when a file in the config directory is changed.
> If a change is not detected, it can be manually reloaded with `systemctl reload pve-wol` or by sending a `SIGHUP`.

### TODO:
[ ] Docker image
[ ] lxc container template
[ ] Switch from `qm` to pve API
[ ] WOL for lxc containers
