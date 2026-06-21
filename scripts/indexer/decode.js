export const hexToUtf8 = (hex) => Buffer.from(hex, 'hex').toString('utf8');
export const hexToBase64 = (hex) => Buffer.from(hex, 'hex').toString('base64');
