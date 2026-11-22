grep -n -i -E "mount" /var/opt/mgu-deploy/current/mgu-deploy.js | grep -v -i "RequiresMountsFor\|^\s*//" | cut -c1-220 | head -30
