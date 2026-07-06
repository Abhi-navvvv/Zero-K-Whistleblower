declare module "snarkjs" {
  const groth16: {
    fullProve: (
      input: Record<string, string | string[]>,
      wasm: string | Uint8Array,
      zkey: string | Uint8Array
    ) => Promise<{ proof: Record<string, string[]>; publicSignals: string[] }>;
    verify: (
      verificationKey: unknown,
      publicSignals: string[],
      proof: Record<string, string[]>
    ) => Promise<boolean>;
  };
  export { groth16 };
}
