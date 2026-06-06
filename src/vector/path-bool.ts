export function maskUnion(a: Uint8ClampedArray, b: Uint8ClampedArray): Uint8ClampedArray {
  const result = new Uint8ClampedArray(a.length);
  const sharedLength = Math.min(a.length, b.length);

  for (let i = 0; i < sharedLength; i++) {
    result[i] = Math.max(a[i], b[i]);
  }

  for (let i = sharedLength; i < a.length; i++) {
    result[i] = a[i];
  }

  return result;
}

export function maskIntersect(a: Uint8ClampedArray, b: Uint8ClampedArray): Uint8ClampedArray {
  const result = new Uint8ClampedArray(a.length);
  const sharedLength = Math.min(a.length, b.length);

  for (let i = 0; i < sharedLength; i++) {
    result[i] = Math.min(a[i], b[i]);
  }

  return result;
}

export function maskSubtract(a: Uint8ClampedArray, b: Uint8ClampedArray): Uint8ClampedArray {
  const result = new Uint8ClampedArray(a.length);
  const sharedLength = Math.min(a.length, b.length);

  for (let i = 0; i < sharedLength; i++) {
    result[i] = Math.max(0, a[i] - b[i]);
  }

  for (let i = sharedLength; i < a.length; i++) {
    result[i] = a[i];
  }

  return result;
}

export function maskXor(a: Uint8ClampedArray, b: Uint8ClampedArray): Uint8ClampedArray {
  const result = new Uint8ClampedArray(a.length);
  const sharedLength = Math.min(a.length, b.length);

  for (let i = 0; i < sharedLength; i++) {
    result[i] = Math.abs(a[i] - b[i]);
  }

  for (let i = sharedLength; i < a.length; i++) {
    result[i] = a[i];
  }

  return result;
}

export function maskInvert(a: Uint8ClampedArray): Uint8ClampedArray {
  const result = new Uint8ClampedArray(a.length);

  for (let i = 0; i < a.length; i++) {
    result[i] = 255 - a[i];
  }

  return result;
}
