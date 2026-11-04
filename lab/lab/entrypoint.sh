#!/bin/bash
set -e

# Generate SSH host keys if not present
ssh-keygen -A 2>/dev/null || true

# Start SSH service
service ssh start || /usr/sbin/sshd

# Start PostgreSQL for Metasploit Framework DB
service postgresql start 2>/dev/null || true

# Execute default command or passed arguments
if [ $# -eq 0 ]; then
    exec /bin/bash
else
    exec "$@"
fi
