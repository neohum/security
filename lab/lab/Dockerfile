FROM kalilinux/kali-rolling

ENV DEBIAN_FRONTEND=noninteractive

# 기본 이미지에 ca-certificates가 없어 HTTPS 미러 리다이렉트 시 발생하는 SSL 검증 오류 해결
RUN echo 'Acquire::https::Verify-Peer "false";' > /etc/apt/apt.conf.d/99ssl-noverify && \
    echo 'Acquire::https::Verify-Host "false";' >> /etc/apt/apt.conf.d/99ssl-noverify && \
    apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -f /etc/apt/apt.conf.d/99ssl-noverify && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        metasploit-framework \
        postgresql \
        postgresql-contrib \
        nasm \
        nmap \
        iputils-ping \
        net-tools \
        curl \
        nano \
        vim && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /root

CMD ["bash"]
