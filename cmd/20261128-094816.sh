cd /var/opt/bmw-voice/current; n=$(grep -n "async speakReply" bmw-voice.js | cut -d: -f1); sed -n "$n,$((n+75))p" bmw-voice.js
