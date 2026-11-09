export enum UserRole {
  ADMIN = 'admin',
  NSM = 'nsm', // National Sales Manager
  BRAND_MANAGER = 'brand_manager', // Brand Manager
  MANAGER = 'manager',
  SUPERVISOR = 'supervisor',
  SELLER = 'seller',
}

export enum PricingMode {
  COMPANY_LDP = 'company_ldp',
  MANUAL_WHOLESALE = 'manual_wholesale',
}

export interface UserAccount {
  id: string;
  username: string;
  password: string;
  fullName: string;
  role: UserRole;
  routeCode: string;
  regionScope: string;
  branch?: string;
  supervisorUsername?: string;
  managerUsername?: string;
  active: boolean;
}

export interface SkuDefinition {
  id: string;
  code: string;
  name: string;
  myanmarSubName: string;
  packSpec: string;
  defaultLdpPrice: number; // in MMK
  imageUrl: string;
  accentColor: string;
  active?: boolean;
}

export interface SkuLineItem {
  skuId: string;
  skuName: string;
  quantity: number;
  unitPrice: number; // MMK
  focQuantity: number;
  // FOC price is permanently locked at 0 MMK
  focPrice: 0;
  lineTotal: number; // quantity * unitPrice
}

export interface NoodleActivationRecord {
  id: string;
  invoiceNo: string;
  activationDate: string; // YYYY-MM-DD
  createdAt: string; // ISO timestamp
  wholesaleStoreName: string;
  pgCover: string; // PG Cover (Yes / No)
  retailerStoreName: string;
  outletType: string;
  phoneNumber: string;
  addressNo: string;
  addressStreet: string;
  addressWard: string;
  township: string;
  fullAddress: string; // Combined automatically from No, Street, Ward, and Township
  branch?: string; // Branch Name (Yangon, Mandalay, Naypyitaw, Bago)
  salesStatus: boolean; // Sales (Yes / No) -> true = Yes, false = No
  pricingMode: PricingMode;
  coveredStatus: boolean;
  nonCoveredReason?: string;
  sellerUsername: string;
  sellerName: string;
  routeCode: string;
  supervisorUsername: string;
  managerUsername: string;
  regionScope: string;
  items: SkuLineItem[];
  totalPaidQty: number;
  totalFocQty: number;
  grandTotalMmk: number;
  remarks?: string;
}
