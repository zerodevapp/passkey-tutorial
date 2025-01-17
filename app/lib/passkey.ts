import { concatHex, keccak256, pad, toHex } from "viem";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";

export var WebAuthnMode: any;
(function (WebAuthnMode) {
    WebAuthnMode["Register"] = "register";
    WebAuthnMode["Login"] = "login";
})(WebAuthnMode || (WebAuthnMode = {}));
export const encodeWebAuthnPubKey = (pubKey: any) => {
    return concatHex([
        toHex(pubKey.pubX, { size: 32 }),
        toHex(pubKey.pubY, { size: 32 }),
        pad(pubKey.authenticatorIdHash as `0x${string}`, { size: 32 })
    ]);
};

export const uint8ArrayToHexString = (array: Uint8Array) => {
    return `0x${Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};
export const hexStringToUint8Array = (hexString: string) => {
    const formattedHexString = hexString.startsWith("0x")
        ? hexString.slice(2)
        : hexString;
    const byteArray = new Uint8Array(formattedHexString.length / 2);
    for (let i = 0; i < formattedHexString.length; i += 2) {
        byteArray[i / 2] = Number.parseInt(formattedHexString.substring(i, i + 2), 16);
    }
    return byteArray;
};
export const b64ToBytes = (base64: string) => {
    const paddedBase64 = base64
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const binString = atob(paddedBase64);
    return Uint8Array.from(binString, (m) => m.codePointAt(0) ?? 0);
};

export const toWebAuthnKey = async ({ passkeyName, passkeyServerUrl, rpID, webAuthnKey, mode = WebAuthnMode.Register, credentials = "include", passkeyServerHeaders = {} }: any) => {
    if (webAuthnKey) {
        return webAuthnKey;
    }
    let pubKey;
    let authenticatorId;
    if (mode === WebAuthnMode.Login) {
        // Get login options
        const loginOptionsResponse = await fetch(`${passkeyServerUrl}/login/options`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...passkeyServerHeaders
            },
            body: JSON.stringify({ rpID }),
            credentials
        });
        const loginOptions = await loginOptionsResponse.json();
        // Start authentication (login)
        console.log("loginOptions", loginOptions)
        loginOptions.extensions= 
        {
            prf: {
                eval: {
                    first: new Uint8Array(new Array(32).fill(1)),
                },
            },
        }
            
            
        
            
        const loginCred = await startAuthentication(loginOptions);
        console.log("loginCred", loginCred)
        const auth1ExtensionResults = loginCred.clientExtensionResults;
        console.log(auth1ExtensionResults);
        authenticatorId = loginCred.id;
        // Verify authentication
        const loginVerifyResponse = await fetch(`${passkeyServerUrl}/login/verify`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...passkeyServerHeaders
            },
            body: JSON.stringify({ cred: loginCred, rpID }),
            credentials
        });
        const loginVerifyResult = await loginVerifyResponse.json();
        if (!loginVerifyResult.verification.verified) {
            throw new Error("Login not verified");
        }
        // Import the key
        pubKey = loginVerifyResult.pubkey; // Uint8Array pubkey
    }
    else {
        // Get registration options
        const registerOptionsResponse = await fetch(`${passkeyServerUrl}/register/options`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...passkeyServerHeaders
            },
            body: JSON.stringify({ username: passkeyName, rpID }),
            credentials
        });
        const registerOptions = await registerOptionsResponse.json();
        console.log("registerOptions", registerOptions)
        const encoder = new TextEncoder();
        const state = {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            username: 'example',
            // userId to be populated in a moment
            // userId: null,
            // salt won't matter for registration
            // it just needs the right type
            salt: new Uint8Array(new Array(32).fill(1)),
            credential: null,
            prfSupported: false
          }
          
          // Crypto Subtle Digest is async
          state.userId = await crypto.subtle.digest('sha-256',
            encoder.encode("username:" + state.username)
          );
          
        registerOptions.options.extensions.prf = {
            eval: {
              first: state.salt,
            },
          },
        console.log("registerOptions", registerOptions)

        // Start registration
        const registerCred = await startRegistration(registerOptions.options);
        console.log("prf support:",registerCred.clientExtensionResults)
        authenticatorId = registerCred.id;
        // Verify registration
        const registerVerifyResponse = await fetch(`${passkeyServerUrl}/register/verify`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...passkeyServerHeaders
            },
            body: JSON.stringify({
                userId: registerOptions.userId,
                username: passkeyName,
                cred: registerCred,
                rpID
            }),
            credentials
        });
        const registerVerifyResult = await registerVerifyResponse.json();
        if (!registerVerifyResult.verified) {
            throw new Error("Registration not verified");
        }
        // Import the key
        pubKey = registerCred.response.publicKey;
    }
    if (!pubKey) {
        throw new Error("No public key returned from registration credential");
    }
    if (!authenticatorId) {
        throw new Error("No authenticator id returned from registration credential");
    }
    console.log("authenticatorId", authenticatorId)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const authenticatorIdHash =  keccak256(uint8ArrayToHexString(b64ToBytes(authenticatorId)));
    const spkiDer = Buffer.from(pubKey, "base64");
    const key = await crypto.subtle.importKey("spki", spkiDer, {
        name: "ECDSA",
        namedCurve: "P-256"
    }, true, ["verify"]);
    // Export the key to the raw format
    const rawKey = await crypto.subtle.exportKey("raw", key);
    const rawKeyBuffer = Buffer.from(rawKey);
    // The first byte is 0x04 (uncompressed), followed by x and y coordinates (32 bytes each for P-256)
    const pubKeyX = rawKeyBuffer.subarray(1, 33).toString("hex");
    const pubKeyY = rawKeyBuffer.subarray(33).toString("hex");
    return {
        pubX: BigInt(`0x${pubKeyX}`),
        pubY: BigInt(`0x${pubKeyY}`),
        authenticatorId,
        authenticatorIdHash
    };
};

