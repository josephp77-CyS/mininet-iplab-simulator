export function parseIpv4Cidr(cidr: string): { ip: string; prefix: number; network: string; netmask: string } | null {
  const parts = cidr.trim().split('/');
  if (parts.length !== 2) return null;
  const ip = parts[0].trim();
  const prefix = parseInt(parts[1].trim(), 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return null;

  const ipNum = ipv4ToNumber(ip);
  if (ipNum === null) return null;

  const maskNum = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const netNum = (ipNum & maskNum) >>> 0;
  const network = numberToIpv4(netNum);
  const netmask = numberToIpv4(maskNum);

  return { ip, prefix, network, netmask };
}

export function ipv4ToNumber(ip: string): number | null {
  const octets = ip.trim().split('.');
  if (octets.length !== 4) return null;
  let num = 0;
  for (let i = 0; i < 4; i++) {
    const octet = parseInt(octets[i], 10);
    if (isNaN(octet) || octet < 0 || octet > 255) return null;
    num = (num << 8) + octet;
  }
  return num >>> 0;
}

export function numberToIpv4(num: number): string {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255
  ].join('.');
}

export function prefixToNetmask(prefix: number): string {
  const maskNum = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return numberToIpv4(maskNum);
}

export function netmaskToPrefix(netmask: string): number {
  const num = ipv4ToNumber(netmask);
  if (num === null) return 24;
  let count = 0;
  for (let i = 31; i >= 0; i--) {
    if ((num & (1 << i)) !== 0) count++;
    else break;
  }
  return count;
}

export function isIpv4InSubnet(ip: string, network: string, prefix: number): boolean {
  const ipNum = ipv4ToNumber(ip);
  const netNum = ipv4ToNumber(network);
  if (ipNum === null || netNum === null) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (netNum & mask);
}

export function areIpsInSameSubnet(ip1: string, ip2: string, prefix: number): boolean {
  const num1 = ipv4ToNumber(ip1);
  const num2 = ipv4ToNumber(ip2);
  if (num1 === null || num2 === null) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (num1 & mask) === (num2 & mask);
}

export function getNetworkAddress(ip: string, prefix: number): string {
  const num = ipv4ToNumber(ip);
  if (num === null) return ip;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return numberToIpv4(num & mask);
}

// IPv6 utilities
export function expandIpv6(ipv6: string): string {
  const clean = ipv6.toLowerCase().trim();
  const parts = clean.split('::');
  let left: string[] = [];
  let right: string[] = [];

  if (parts.length > 2) return clean; // invalid

  if (parts.length === 2) {
    left = parts[0] ? parts[0].split(':') : [];
    right = parts[1] ? parts[1].split(':') : [];
    const missing = 8 - (left.length + right.length);
    const middle = Array(missing > 0 ? missing : 0).fill('0000');
    const all = [...left, ...middle, ...right];
    return all.map(p => p.padStart(4, '0')).join(':');
  }

  return clean.split(':').map(p => p.padStart(4, '0')).join(':');
}

export function parseIpv6Cidr(cidr: string): { ip: string; prefix: number; expanded: string } | null {
  const parts = cidr.trim().split('/');
  if (parts.length !== 2) return null;
  const ip = parts[0].trim();
  const prefix = parseInt(parts[1].trim(), 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 128) return null;
  const expanded = expandIpv6(ip);
  return { ip, prefix, expanded };
}

export function isIpv6InSubnet(ip: string, netPrefix: string, prefixLen: number): boolean {
  const expIp = expandIpv6(ip).replace(/:/g, '');
  const expNet = expandIpv6(netPrefix).replace(/:/g, '');
  const hexCharsToCheck = Math.floor(prefixLen / 4);
  return expIp.slice(0, hexCharsToCheck) === expNet.slice(0, hexCharsToCheck);
}

export function resolveInterfaceName(
  node: { id: string; name?: string; interfaces: Record<string, any> },
  rawName: string
): string {
  const clean = rawName.trim();
  if (!clean) return clean;
  if (clean === 'lo' || clean === 'loopback' || clean === 'lo0') return 'lo';

  // 1. Exact match in existing interfaces
  if (node.interfaces[clean]) return clean;

  const nodeName = node.name || node.id;

  // 2. Try prefixed match: e.g. user typed "eth0" on "c11" -> check "c11-eth0"
  const prefixedId = `${node.id}-${clean}`;
  if (node.interfaces[prefixedId]) return prefixedId;

  const prefixedName = `${nodeName}-${clean}`;
  if (node.interfaces[prefixedName]) return prefixedName;

  // 3. Try stripped match: e.g. user typed "c11-eth0" -> check "eth0"
  const prefixPattern = new RegExp(`^(${node.id}|${nodeName})[-_]`, 'i');
  const stripped = clean.replace(prefixPattern, '');
  if (node.interfaces[stripped]) return stripped;

  // 4. Try suffix match in keys: e.g. "eth1" matches any key ending in "-eth1" or "_eth1"
  const match = Object.keys(node.interfaces).find(
    k =>
      k.toLowerCase() === clean.toLowerCase() ||
      k.toLowerCase().endsWith(`-${clean.toLowerCase()}`) ||
      k.toLowerCase().endsWith(`_${clean.toLowerCase()}`)
  );
  if (match) return match;

  // 5. Default convention: if it starts with eth, prefix with node.name/id if existing interfaces use prefix convention
  const firstKey = Object.keys(node.interfaces)[0];
  if (/^eth\d+$/i.test(clean) && firstKey && (firstKey.startsWith(`${node.id}-`) || firstKey.startsWith(`${nodeName}-`))) {
    return `${nodeName}-${clean.toLowerCase()}`;
  }

  return clean;
}

