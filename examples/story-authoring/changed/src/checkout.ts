import { authorizePayment } from "./payment.js";

export interface Order {
  readonly id: string;
}

export async function submitCheckout(order: Order): Promise<string> {
  recordAudit(order);
  return authorizePayment(order);
}

function recordAudit(order: Order): void {
  console.log(`checkout:${order.id}`);
}
