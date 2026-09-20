export interface Order {
  readonly id: string;
}

export async function submitCheckout(order: Order): Promise<string> {
  recordAudit(order);
  return charge(order);
}

function charge(order: Order): string {
  return `charged:${order.id}`;
}

function recordAudit(order: Order): void {
  console.log(`checkout:${order.id}`);
}
