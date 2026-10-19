#!/bin/sh
B=/usr/lib/postgresql/16/bin
pg_isready -h 127.0.0.1 -p 54329 >/dev/null 2>&1 && exit 0
rm -f /home/claude/.pgtest/data/postmaster.pid
su claude -c "$B/pg_ctl -D /home/claude/.pgtest/data -l /home/claude/.pgtest/server.log -o '-p 54329 -k /tmp' start" >/dev/null 2>&1
sleep 3
pg_isready -h 127.0.0.1 -p 54329
