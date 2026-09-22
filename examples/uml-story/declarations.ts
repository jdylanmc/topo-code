export interface Contract {
  readonly id: string;
}

export interface ExtendedContract extends Contract {
  readonly detail: string;
}

export class ContractImplementation implements Contract {
  readonly id = "implementation";
}

export type ContractAlias = Contract;

export interface ContractConsumer {
  readonly dependency: Contract;
}
