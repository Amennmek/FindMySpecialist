function normalizePart(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\b(APARTMENT|APT)\b/g, 'APT')
    .replace(/\b(SUITE|STE)\b/g, 'STE')
    .replace(/\b(NORTH|SOUTH|EAST|WEST)\b/g, direction => direction[0])
    .replace(/\b(STREET|ST)\b/g, 'ST')
    .replace(/\b(AVENUE|AVE)\b/g, 'AVE')
    .replace(/\b(ROAD|RD)\b/g, 'RD')
    .replace(/\b(BOULEVARD|BLVD)\b/g, 'BLVD')
    .replace(/\b(DRIVE|DR)\b/g, 'DR')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function practiceAddressKey(address = {}) {
  return [
    normalizePart(address.street),
    normalizePart(address.suite),
    normalizePart(address.city),
    normalizePart(address.state),
    normalizePart(address.zip).slice(0, 5)
  ].join('|');
}

module.exports = { normalizePart, practiceAddressKey };
