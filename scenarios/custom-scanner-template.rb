##
# Metasploit 2/e Chapter 3: Writing Your Own Scanner Module
# Textbook-compliant Custom TCP Banner Grabber Scanner
#
# Usage:
#   1. Copy this file into your Kali box:
#      mkdir -p ~/.msf4/modules/auxiliary/scanner/custom/
#      cp custom-scanner-template.rb ~/.msf4/modules/auxiliary/scanner/custom/custom_tcp_banner.rb
#   2. In msfconsole:
#      msf6 > reload_all
#      msf6 > use auxiliary/scanner/custom/custom_tcp_banner
#      msf6 auxiliary(scanner/custom/custom_tcp_banner) > set RHOSTS 172.28.0.20
#      msf6 auxiliary(scanner/custom/custom_tcp_banner) > set RPORT 21
#      msf6 auxiliary(scanner/custom/custom_tcp_banner) > run
##

require 'msf/core'

class MetasploitModule < Msf::Auxiliary
  include Msf::Exploit::Remote::Tcp
  include Msf::Auxiliary::Scanner
  include Msf::Auxiliary::Report

  def initialize(info = {})
    super(
      update_info(
        info,
        'Name'        => 'Metasploit 2/e Ch.3 Custom TCP Banner Scanner',
        'Description' => %q{
          This module is a textbook example from Metasploit: The Penetration Tester's Guide
          (2nd Edition) Chapter 3. It establishes a raw TCP connection to a range of hosts
          on a specified target port, receives the initial service banner, and stores the
          discovered service in the Metasploit framework database.
        },
        'Author'      => [
          'Metasploit 2/e Authors',
          'Security Simulation Lab <security@simulation.internal>'
        ],
        'License'     => MSF_LICENSE,
        'References'  => [
          ['URL', 'https://nostarch.com/metasploit2']
        ]
      )
    )

    register_options(
      [
        Opt::RPORT(21),
        OptInt.new('TIMEOUT', [true, 'Connection & banner read timeout in seconds', 5]),
        OptString.new('PROBE', [false, 'Optional string probe to send after connection', ''])
      ]
    )
  end

  def run_host(ip)
    timeout = datastore['TIMEOUT']
    probe   = datastore['PROBE']

    begin
      ::Timeout.timeout(timeout) do
        connect

        # If a probe payload was specified, transmit it first
        if probe && !probe.empty?
          sock.put(probe + "\r\n")
        end

        # Read banner returned by the remote service
        banner = sock.get_once(-1, timeout)

        if banner && !banner.empty?
          clean_banner = banner.to_s.gsub(/[\r\n]+/, ' ').strip
          print_good("#{ip}:#{rport} - Received banner: #{clean_banner}")

          # Report service to Metasploit workspace database
          report_service(
            host:  ip,
            port:  rport,
            proto: 'tcp',
            name:  'banner_probe',
            info:  clean_banner
          )
        else
          print_status("#{ip}:#{rport} - Connected successfully, but no banner was received.")
        end
      end
    rescue ::Rex::ConnectionRefused
      vprint_error("#{ip}:#{rport} - TCP Connection Refused.")
    rescue ::Rex::HostUnreachable
      vprint_error("#{ip}:#{rport} - Host Unreachable.")
    rescue ::Rex::ConnectionTimeout, ::Timeout::Error
      vprint_error("#{ip}:#{rport} - Connection or banner read timed out.")
    rescue ::Errno::EPIPE, ::Errno::ECONNRESET => e
      vprint_error("#{ip}:#{rport} - Connection reset by peer: #{e.message}")
    rescue ::StandardError => e
      print_error("#{ip}:#{rport} - Unexpected error: #{e.class} - #{e.message}")
    ensure
      disconnect rescue nil
    end
  end
end
