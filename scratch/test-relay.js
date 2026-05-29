async function main() {
  try {
    // 1. Get OIDC mock token
    const oidcRes = await fetch("http://localhost:3001/api/mock-oidc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@bennett.edu.in", nonce: "testnonce" }),
    });

    const oidcData = await oidcRes.json();
    console.log("Mock OIDC Response:", oidcData);

    if (!oidcRes.ok) {
      throw new Error("Failed to get OIDC token");
    }

    // 2. Call relayer endpoint
    const relayRes = await fetch("http://localhost:3001/api/relay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submitReportWithOidc",
        payload: {
          idToken: oidcData.id_token,
          jwksUri: "http://localhost:3001/api/mock-oidc",
          orgId: "0",
          category: 1,
          encryptedCIDHex: "0x123456",
        }
      })
    });

    const relayData = await relayRes.json();
    console.log("Relayer Status:", relayRes.status);
    console.log("Relayer Response:", JSON.stringify(relayData, null, 2));

  } catch (err) {
    console.error("Test execution failed:", err);
  }
}

main();
