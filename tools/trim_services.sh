#!/bin/sh
# Stop the services DeskGadget does not use, and keep them off across boots.
# Everything here is reversible: set autostart back to true and start them.
set -e

CONF=/etc/supervisord.conf

mount -o remount,rw / 2>/dev/null || true

for program in superbird bluetoothd swupdate; do
  sed -i "/^\[program:$program\]/,/^\[program:/ s/^autostart=true/autostart=false/" "$CONF"
done

supervisorctl stop superbird bluetoothd swupdate >/dev/null 2>&1 || true

echo "autostart settings:"
grep -A6 -E 'program:(superbird|bluetoothd|swupdate)' "$CONF" | grep autostart
echo "status:"
supervisorctl status
free -m | sed -n 2p
