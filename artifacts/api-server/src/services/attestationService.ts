import { privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToBytes } from "viem";

export interface AttestationPayload {
  assetId: string;
  requestId: string;
  state: string;
  nav: bigint;
  yieldRate: bigint;
  riskStatus: `0x${string}`;
  nonce: bigint;
  timestamp: bigint;
}

export interface SignedAttestation {
  payload: AttestationPayload;
  signature: `0x${string}`;
  signer: `0x${string}`;
}

export class AttestationService {
  private attesterAccount;
  private nonceCounter = 1n;

  constructor(privateKey?: string) {
    // Default deterministic private key for PoC if ATTESTER_PRIVATE_KEY is not provided
    const key = (privateKey || process.env.ATTESTER_PRIVATE_KEY ||
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as `0x${string}`;
    this.attesterAccount = privateKeyToAccount(key);
  }

  getSignerAddress(): `0x${string}` {
    return this.attesterAccount.address;
  }

  async generateAttestation(
    assetId: string,
    requestId: string,
    state: string,
    nav: number,
    yieldRate: number,
    riskPass: boolean,
    oracleAdapterAddress = "0x0000000000000000000000000000000000000000",
    chainId = 31337
  ): Promise<SignedAttestation> {
    const nonce = this.nonceCounter++;
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const navBigInt = BigInt(Math.floor(nav));
    const yieldBigInt = BigInt(Math.floor(yieldRate * 100)); // basis points
    const riskStatus = keccak256(stringToBytes(riskPass ? "PASS" : "FAIL"));

    const domain = {
      name: "RWA-OracleAdapter",
      version: "1.0.0",
      chainId,
      verifyingContract: oracleAdapterAddress as `0x${string}`,
    };

    const types = {
      Attestation: [
        { name: "assetId", type: "string" },
        { name: "requestId", type: "string" },
        { name: "state", type: "string" },
        { name: "nav", type: "uint256" },
        { name: "yieldRate", type: "uint256" },
        { name: "riskStatus", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "timestamp", type: "uint256" },
      ],
    };

    const message = {
      assetId,
      requestId,
      state,
      nav: navBigInt,
      yieldRate: yieldBigInt,
      riskStatus,
      nonce,
      timestamp,
    };

    const signature = await this.attesterAccount.signTypedData({
      domain,
      types,
      primaryType: "Attestation",
      message,
    });

    return {
      payload: message,
      signature,
      signer: this.attesterAccount.address,
    };
  }
}
