import type { Order } from "./checkout.js";

export function authorizePayment(order: Order): string {
  return `authorized:${order.id}`;
}
