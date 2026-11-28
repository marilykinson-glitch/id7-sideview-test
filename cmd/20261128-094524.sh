node -e "const fs=require('fs');const f='/var/opt/bmw-voice/tts-cache/ca449cb9db304055.wav';console.log('B64 '+fs.readFileSync(f).toString('base64'))"
