'use client';

import { createContext, type ReactNode, useContext } from 'react';

export interface ChannelOption {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
  position: number;
}

export interface RoleOption {
  id: string;
  name: string;
  color: number;
  managed: boolean;
}

export interface GuildData {
  guildId: string;
  guildName: string;
  channels: ChannelOption[];
  roles: RoleOption[];
  voted: boolean;
  admin: boolean;
  userId: string;
  voteUrl: string | null;
  timezone: string;
  timezones: string[];
}

const Context = createContext<GuildData | null>(null);

export function GuildProvider({ value, children }: { value: GuildData; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useGuild(): GuildData {
  const value = useContext(Context);
  if (!value) throw new Error('useGuild outside GuildProvider');
  return value;
}

export const ChannelType = {
  Text: 0,
  Voice: 2,
  Category: 4,
  Announcement: 5,
  Forum: 15,
} as const;

export function useChannelName(): (id: string | null | undefined) => string {
  const { channels } = useGuild();
  return (id) => {
    if (!id) return '';
    const channel = channels.find((entry) => entry.id === id);
    return channel ? `#${channel.name}` : 'Deleted channel';
  };
}

export function useRoleName(): (id: string | null | undefined) => string {
  const { roles } = useGuild();
  return (id) => {
    if (!id) return '';
    return roles.find((entry) => entry.id === id)?.name ?? 'Deleted role';
  };
}
