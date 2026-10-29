export type Order = { id: string; item: string; status: 'processing' | 'shipped' | 'delivered' }

const ORDERS: Record<string, Order[]> = {
  'cus-1': [
    { id: 'A-100', item: 'Desk lamp', status: 'shipped' },
    { id: 'A-101', item: 'Notebook', status: 'processing' },
  ],
  'cus-2': [{ id: 'B-200', item: 'Office chair', status: 'delivered' }],
}

export async function ordersFor(customerId: string): Promise<Order[]> {
  return ORDERS[customerId] ?? []
}
