#!/bin/bash
cd /home/z/my-project
LOGFILE=/home/z/my-project/dev.log
echo "=== Starting standalone at $(date) ===" >> $LOGFILE
while true; do
  node .next/standalone/server.js >> $LOGFILE 2>&1
  echo "=== Crashed at $(date), restarting in 2s ===" >> $LOGFILE
  sleep 2
done
