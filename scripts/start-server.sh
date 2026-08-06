#!/bin/bash
cd /home/z/my-project
LOGFILE=/home/z/my-project/dev.log
echo "=== Starting server at $(date) ===" >> $LOGFILE
while true; do
  npx next dev -p 3000 2>&1 >> $LOGFILE
  echo "=== Server crashed at $(date), restarting in 3s ===" >> $LOGFILE
  sleep 3
done
