// Tarayıcı WebAuthn yardımcıları (bağımlılıksız): Better Auth passkey uçlarının JSON seçeneklerini
// `navigator.credentials` çağrılarına çevirir ve yanıtı sunucunun beklediği JSON biçimine kodlar.
// Kullanıcı doğrulaması (PIN/biyometri) zorunludur; sunucu `userVerified` bayrağını ayrıca denetler.

export const b64uToBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const bytesToB64u = (buf: ArrayBuffer): string => {
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

type Descriptor = { id: string; type: 'public-key'; transports?: AuthenticatorTransport[] };

export type RegistrationOptionsJSON = {
  challenge: string;
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  excludeCredentials?: Descriptor[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
};

export type AuthenticationOptionsJSON = {
  challenge: string;
  rpId?: string;
  timeout?: number;
  allowCredentials?: Descriptor[];
  userVerification?: UserVerificationRequirement;
};

const descriptors = (list: Descriptor[] | undefined): PublicKeyCredentialDescriptor[] | undefined =>
  list?.map((d) => ({
    type: d.type,
    id: b64uToBytes(d.id),
    ...(d.transports ? { transports: d.transports } : {}),
  }));

export function webauthnSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

export async function createCredential(options: RegistrationOptionsJSON) {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: b64uToBytes(options.challenge),
      rp: options.rp,
      user: { ...options.user, id: b64uToBytes(options.user.id) },
      pubKeyCredParams: options.pubKeyCredParams,
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
      ...(options.excludeCredentials
        ? { excludeCredentials: descriptors(options.excludeCredentials) }
        : {}),
      authenticatorSelection: {
        ...options.authenticatorSelection,
        userVerification: 'required',
      },
      attestation: options.attestation ?? 'none',
    },
  })) as PublicKeyCredential | null;
  if (cred === null) throw new Error('cancelled');
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: bytesToB64u(cred.rawId),
    type: 'public-key' as const,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: bytesToB64u(r.clientDataJSON),
      attestationObject: bytesToB64u(r.attestationObject),
      transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
    },
  };
}

export async function getCredential(options: AuthenticationOptionsJSON) {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: b64uToBytes(options.challenge),
      ...(options.rpId === undefined ? {} : { rpId: options.rpId }),
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
      ...(options.allowCredentials
        ? { allowCredentials: descriptors(options.allowCredentials) }
        : {}),
      userVerification: 'required',
    },
  })) as PublicKeyCredential | null;
  if (cred === null) throw new Error('cancelled');
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bytesToB64u(cred.rawId),
    type: 'public-key' as const,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: bytesToB64u(r.clientDataJSON),
      authenticatorData: bytesToB64u(r.authenticatorData),
      signature: bytesToB64u(r.signature),
      ...(r.userHandle ? { userHandle: bytesToB64u(r.userHandle) } : {}),
    },
  };
}
