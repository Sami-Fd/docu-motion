import {z} from 'zod';

export const titleField = z.string().min(1).max(48);
export const sourceField = z.string().min(1).max(80).optional();
export const cueField = z.string().min(1).max(40).optional();

export const sharedFields = {title: titleField, source: sourceField};
