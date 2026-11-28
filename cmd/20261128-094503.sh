f=$(ls -t /var/opt/bmw-voice/tts-cache/*.wav | head -1); echo "FILE $f"; base64 "$f" | tr -d '\n'; echo
