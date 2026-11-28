cat /proc/loadavg; nproc 2>/dev/null; grep -c ^processor /proc/cpuinfo
snap(){ for p in /proc/[0-9]*; do read -r l < $p/stat 2>/dev/null || continue; set -- ${l#*) }; echo "${p#/proc/} $(( ${12} + ${13} ))"; done; }
snap > /tmp/s1; sleep 3; snap > /tmp/s2
awk 'NR==FNR{a[$1]=$2;next} ($1 in a){d=$2-a[$1]; if(d>3) print d, $1}' /tmp/s1 /tmp/s2 | sort -rn | head -15 | while read d p; do printf "%5s%%  %6s  %s\n" $((d/3)) $p "$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | cut -c1-150)"; done
echo ---; grep -E 'MemTotal|MemAvailable' /proc/meminfo; echo ---; cat /run/bmw-voice/hmi.json
