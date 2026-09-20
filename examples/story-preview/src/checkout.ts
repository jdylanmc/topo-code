export interface Order {
  readonly id: string;
}

export async function submitCheckout(order: Order): Promise<string> {
  await validate(order);
  return charge(order);
}

async function validate(order: Order): Promise<void> {
  if (!order.id) throw new Error("Order id is required");
}

function charge(order: Order): string {
  return `charged:${order.id}`;
}
