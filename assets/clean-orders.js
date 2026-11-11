// Core transform. The API validates records before calling this function.
export function cleanOrders(orders) {
    const seen = new Set();

    return orders.filter(order => {
        const id = order.id.trim();
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    }).map(order => {
        const [dollars, cents] = order.amount.split('.').map(Number);
        return {
            id: order.id.trim(),
            date: order.date,
            category: order.category.trim().toLowerCase(),
            amountCents: dollars * 100 + cents,
            currency: 'USD',
            email: '[redacted]',
        };
    });
}
