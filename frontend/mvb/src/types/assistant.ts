export type InformationCard = {
  id: string;
  title: string;
  description?: string | null;
  badge?: string | null;
  facts: { label: string; value: string }[];
  progress?: number;
};
export type InvoiceItem = {
  name: string;
  category: string;
  periodStart?: string;
  periodEnd?: string;
  quantity?: number;
  amountBeforeTax?: number;
  amountIncludingTax?: number;
};
export type Invoice = {
  note?: string;
  id: string;
  month: string;
  periodStart?: string;
  periodEnd?: string;
  date?: string;
  dueDate?: string;
  paidAt?: string | null;
  reference?: string;
  customerNumber?: string;
  status?: string;
  currency: string;
  items: InvoiceItem[];
  subtotal?: number;
  discounts?: number;
  previousBalance?: number;
  total?: number;
};
export type AnswerPresentation = {
  title: string;
  source: "user" | "website";
  cards: InformationCard[];
  invoices: Invoice[];
};

export type NavigationStep = {
  action: string;
  instruction: string;
  location?: string | null;
};

export type AssistantResult = {
  success: boolean;
  type: "navigation" | "answer" | "user_data";
  transcript: string;
  currentScreen: string | null;
  targetScreen: string | null;
  steps: NavigationStep[];
  answer: string;
  presentation?: AnswerPresentation | null;
};
