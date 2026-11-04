FROM kalilinux/kali-rolling

ENV DEBIAN_FRONTEND=noninteractive

# 기본 설정 및 SSL 검증 우회 후 ca-certificates 설치
RUN echo 'Acquire::https::Verify-Peer "false";' > /etc/apt/apt.conf.d/99ssl-noverify && \
    echo 'Acquire::https::Verify-Host "false";' >> /etc/apt/apt.conf.d/99ssl-noverify && \
    apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg && \
    rm -f /etc/apt/apt.conf.d/99ssl-noverify && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        metasploit-framework \
        postgresql \
        postgresql-contrib \
        nasm \
        nmap \
        whois \
        dnsutils \
        traceroute \
        tcpdump \
        iptables \
        iputils-ping \
        net-tools \
        curl \
        wget \
        nano \
        vim \
        openssh-server \
        python3 \
        python3-pip && \
    # SSH Server 설정 (root 로그인 허용, 비밀번호 toor)
    mkdir -p /var/run/sshd && \
    echo 'root:toor' | chpasswd && \
    sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config && \
    sed -i 's/PermitRootLogin without-password/PermitRootLogin yes/' /etc/ssh/sshd_config && \
    # Tailscale CLI 설치
    curl -fsSL https://tailscale.com/install.sh | sh || true && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /root

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bash"]
