
class BookingLinkService {
  isValid(url) {
    if (typeof url !== 'string') return false;

    try {
      const parsed = new URL(url);

      return parsed.protocol === 'https:' &&
        Boolean(parsed.hostname) &&
        !['localhost', '127.0.0.1'].includes(
          parsed.hostname
        );
    } catch {
      return false;
    }
  }

  getBookingUrl(url) {
    return this.isValid(url) ? url : null;
  }
}

module.exports = BookingLinkService;
