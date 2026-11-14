#!/system/bin/sh
# User-authorized DAYU200 development image only. Runs once and exits.
# Apply official policies only; leave clocks, thermal limits and SELinux intact.
power-shell setmode 600
power-shell setmode 602
power-shell wakeup
