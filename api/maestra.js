// Verificación de la clave maestra del usuario principal. Aquí solo existe el HASH (scrypt), nunca el texto de la clave.
import crypto from 'crypto';
const MAESTRA = 'scrypt$+zx7x+A6iEih4uUcqfmKVA==$c2jgp+e4cJmQLjTQ9BKeGDl9YUtEJqFYUmnYGv8EnvZcfgs+1zu5BwgWwtTwttQ6zlttIuq3MYiaAYUb6l4jIw==';
export const verMaestra = p => {
  try { const [, sal, h] = MAESTRA.split('$'), e = Buffer.from(h, 'base64'), d = crypto.scryptSync(String(p ?? '').normalize('NFC'), Buffer.from(sal, 'base64'), e.length);
    return d.length === e.length && crypto.timingSafeEqual(d, e); } catch { return false; }
};
