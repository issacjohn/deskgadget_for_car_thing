#!/bin/sh
# Apply the DeskGadget boot assets to BOTH root slots.
# The bootloader can boot either _a (mmcblk0p14) or _b (mmcblk0p15); anything
# written to / only exists on the slot that was active, so DeskThing's boot
# logo can reappear after a slot switch until both are patched.
#
# Run from the repo (adb push strips nothing, so drop CRLF first):
#   adb push tools/patch_slots.sh /var/deskgadget/patch-slots.sh
#   adb shell "tr -d '\r' < /var/deskgadget/patch-slots.sh > /var/deskgadget/ps.sh; sh /var/deskgadget/ps.sh"
#
# Expects /var/deskgadget/boot.html and /var/deskgadget/appstart.png.
set -u

WEBAPP=usr/share/qt-superbird-app/webapp
ROOT_ACTIVE=$(cat /proc/cmdline | tr ' ' '\n' | sed -n 's/^root=//p')

patch_tree() {
  base="$1"
  web="$base/$WEBAPP"

  if [ ! -d "$web" ]; then
    echo "skip $base (no webapp)"
    return 0
  fi

  if [ -f "$web/index.html" ] && [ ! -f "$web/index.deskthing.html" ]; then
    cp "$web/index.html" "$web/index.deskthing.html"
  fi
  cp /var/deskgadget/boot.html "$web/index.html"
  cp /var/deskgadget/appstart.png "$web/images/appstart.png"

  for program in superbird bluetoothd swupdate; do
    sed -i "/^\[program:$program\]/,/^\[program:/ s/^autostart=true/autostart=false/" \
      "$base/etc/supervisord.conf"
  done
  echo "patched $base"
}

mount -o remount,rw / 2>/dev/null || true
patch_tree ""

case "$ROOT_ACTIVE" in
  /dev/mmcblk0p14) OTHER=/dev/block/179:15 ;;
  /dev/mmcblk0p15) OTHER=/dev/block/179:14 ;;
  *) OTHER="" ;;
esac

if [ -n "$OTHER" ]; then
  mkdir -p /var/other
  if mount -t ext4 "$OTHER" /var/other 2>/dev/null; then
    patch_tree "/var/other"
    sync
    umount /var/other
  else
    echo "could not mount $OTHER"
  fi
fi

echo "done"
