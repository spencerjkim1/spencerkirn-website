// Synthetic records only. Shared by the preview and Worker for reproducible inputs.
export const DATASETS = {
    sample: { label: 'Small / 12 orders', batches: 1 },
    batch: { label: 'Medium / 120 orders', batches: 10 },
    large: { label: 'Large / 600 orders', batches: 50 },
};

export function createOrders(dataset) {
    if (!Object.hasOwn(DATASETS, dataset)) throw new Error('Unknown sample dataset');
    const amounts = ['49.00', '129.00', '25.00', '89.00', '15.00', '240.00', '65.00', '32.00'];
    const categories = [' software ', 'HARDWARE', 'Software', 'hardware ', ' SERVICES ', 'Hardware', 'services', 'software'];
    return Array.from({ length: DATASETS[dataset].batches }, (_, batch) => {
        const rows = amounts.map((amount, index) => ({
            id: `ORD-${String(batch * 12 + index + 1).padStart(4, '0')}`,
            date: `2026-11-${String(index + 1).padStart(2, '0')}`,
            email: `customer${batch * 12 + index + 1}@example.invalid`,
            category: categories[index], amount, currency: 'usd',
        }));
        return [...rows, { ...rows[0] },
            { ...rows[1], id: `BAD-AMOUNT-${batch}`, amount: 'not-a-number' },
            { ...rows[2], id: `BAD-DATE-${batch}`, date: '2026-02-30' },
            { ...rows[3], id: '', amount: '10.00' }];
    }).flat();
}
