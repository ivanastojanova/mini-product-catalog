/** Safe shape returned to the client — never includes `passwordHash`. */
export type AuthenticatedCustomer = {
  id: number;
  email: string;
  name: string;
};

export type AuthError = {
  message: string;
};
