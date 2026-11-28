node -e "const s=require('/run/bimmer-drive/status.json').native;console.log(JSON.stringify(s))" | cut -c1-1500
