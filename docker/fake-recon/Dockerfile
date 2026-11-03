FROM node:20-alpine

# Install bind-tools, whois, and curl for in-container testing and diagnostics
RUN apk add --no-cache bind-tools whois curl

WORKDIR /app

# Copy server implementation and DNS zone configurations
COPY server.js ./
COPY named.conf /etc/bind/named.conf
COPY megacorp.internal.zone /etc/bind/megacorp.internal.zone
COPY named.conf ./
COPY megacorp.internal.zone ./

# Expose reconnaissance service ports
# 43: Whois
# 53: DNS (UDP & TCP AXFR)
# 8080: Netcraft HTTP
EXPOSE 43 53/udp 53/tcp 8080

ENV NODE_ENV=production
ENV WHOIS_PORT=43
ENV DNS_PORT=53
ENV NETCRAFT_PORT=8080

CMD ["node", "server.js"]
