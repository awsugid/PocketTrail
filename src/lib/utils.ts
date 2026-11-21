export { cn } from 'cn';
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
export type WithoutChild<T> = T extends unknown ? Omit<T, 'child'> : never;
export type WithoutChildren<T> = T extends unknown ? Omit<T, 'children'> : never;
export type WithoutChildrenOrChild<T> = T extends unknown ? Omit<T, 'children' | 'child'> : never;
