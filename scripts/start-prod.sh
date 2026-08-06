#!/bin/bash
cd /home/z/my-project
LOGFILE=/home/z/my-project/dev.log
echo "=== Starting prod server at $(date) ===" >> $LOGFILE
while true; do
  npx next start -p 3000 >> $LOGFILE 2>&1
  echo "=== Crashed at $(date), restarting in 2s ===" >> $LOGFILE
  sleep 2
done
