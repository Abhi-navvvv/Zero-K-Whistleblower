export const EPOCH_LENGTH_MS = 24 * 60 * 60 * 1000;

export function getCurrentEpoch(): number {
    return Math.floor(Date.now() / EPOCH_LENGTH_MS);
}

export function formatEpochRange(epoch: number): string {
    const start = new Date(epoch * EPOCH_LENGTH_MS);
    const end = new Date((epoch + 1) * EPOCH_LENGTH_MS);
    return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
}
