'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import AddBoxOutlined from '@mui/icons-material/AddBoxOutlined';
import ArticleOutlined from '@mui/icons-material/ArticleOutlined';
import CategoryOutlined from '@mui/icons-material/CategoryOutlined';
import LocalShippingOutlined from '@mui/icons-material/LocalShippingOutlined';
import CreditCardOutlined from '@mui/icons-material/CreditCardOutlined';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import PeopleAltOutlined from '@mui/icons-material/PeopleAltOutlined';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import MenuRounded from '@mui/icons-material/MenuRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import PaletteOutlined from '@mui/icons-material/PaletteOutlined';
import RocketLaunchOutlined from '@mui/icons-material/RocketLaunchOutlined';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import StorefrontOutlined from '@mui/icons-material/StorefrontOutlined';
import ViewListOutlined from '@mui/icons-material/ViewListOutlined';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

export interface StoreShellProps {
  store: {
    id: string;
    name: string;
    status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED';
    logoUrl: string | null;
  };
  /** Public address when the store is live, else null. */
  liveUrl: string | null;
  children: ReactNode;
}

const STATUS = {
  DRAFT: { label: 'پیش‌نویس', color: 'default' },
  PUBLISHED: { label: 'منتشرشده', color: 'success' },
  UNPUBLISHED: { label: 'لغو انتشار', color: 'warning' },
} as const;

const SIDEBAR_WIDTH = 272;
const INK = '#141a33';
const INK_SOFT = '#1d2547';
const TEXT = '#e8eaf8';
const TEXT_MUTED = '#b4bad8';
const ACCENT = '#a5b4fc';

type Item = {
  label: string;
  href: string;
  icon: ReactNode;
  match?: (p: string) => boolean;
  children?: {
    label: string;
    href: string;
    icon: ReactNode;
    exact?: boolean;
  }[];
};

function buildNav(base: string): Item[] {
  return [
    {
      label: 'سفارش‌ها',
      href: `${base}/orders`,
      icon: <ReceiptLongOutlined />,
      match: (p) => p.startsWith(`${base}/orders`),
    },
    {
      label: 'مشتری‌ها',
      href: `${base}/customers`,
      icon: <PeopleAltOutlined />,
      match: (p) => p.startsWith(`${base}/customers`),
    },
    {
      label: 'محصولات',
      href: `${base}/products`,
      icon: <Inventory2Outlined />,
      match: (p) => p.startsWith(`${base}/products`),
      children: [
        {
          label: 'همهٔ محصولات',
          href: `${base}/products`,
          icon: <ViewListOutlined fontSize='small' />,
          exact: true,
        },
        {
          label: 'افزودن محصول',
          href: `${base}/products/new`,
          icon: <AddBoxOutlined fontSize='small' />,
          exact: true,
        },
      ],
    },
    {
      label: 'دسته‌بندی‌ها',
      href: `${base}/categories`,
      icon: <CategoryOutlined />,
      match: (p) => p.startsWith(`${base}/categories`),
    },
    {
      label: 'روش‌های ارسال',
      href: `${base}/shipping`,
      icon: <LocalShippingOutlined />,
      match: (p) => p.startsWith(`${base}/shipping`),
    },
    {
      label: 'پرداخت آنلاین',
      href: `${base}/payments`,
      icon: <CreditCardOutlined />,
      match: (p) => p.startsWith(`${base}/payments`),
    },
    {
      label: 'صفحه‌ها',
      href: `${base}/pages`,
      icon: <ArticleOutlined />,
      match: (p) => p.startsWith(`${base}/pages`),
    },
    {
      label: 'ظاهر',
      href: `${base}/appearance`,
      icon: <PaletteOutlined />,
      match: (p) => p.startsWith(`${base}/appearance`),
    },
    {
      label: 'انتشار',
      href: `${base}/publish`,
      icon: <RocketLaunchOutlined />,
      match: (p) => p.startsWith(`${base}/publish`),
    },
    {
      label: 'تنظیمات',
      href: base,
      icon: <SettingsOutlined />,
      match: (p) => p === base,
    },
  ];
}

const rowSx = (active: boolean) => ({
  borderRadius: 2.5,
  mb: 0.5,
  px: 1.5,
  py: 1,
  color: active ? '#fff' : TEXT_MUTED,
  bgcolor: active ? 'rgba(165,180,252,0.16)' : 'transparent',
  position: 'relative' as const,
  '&::before': active
    ? {
        content: '""',
        position: 'absolute',
        insetInlineStart: 0,
        top: 10,
        bottom: 10,
        width: 3,
        borderRadius: 3,
        bgcolor: ACCENT,
      }
    : undefined,
  '&:hover': {
    bgcolor: active ? 'rgba(165,180,252,0.22)' : 'rgba(255,255,255,0.06)',
    color: '#fff',
  },
  '&.Mui-focusVisible': { outline: '3px solid #ffffff', outlineOffset: '-2px' },
  '& .MuiListItemIcon-root': {
    color: active ? ACCENT : 'inherit',
    minWidth: 40,
  },
  '& .MuiListItemText-primary': {
    fontWeight: active ? 700 : 500,
    fontSize: 15,
  },
});

function Sidebar({
  store,
  base,
  pathname,
  onNavigate,
}: {
  store: StoreShellProps['store'];
  base: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  const nav = buildNav(base);
  const [open, setOpen] = useState<Record<string, boolean>>({
    محصولات: pathname.startsWith(`${base}/products`),
  });
  return (
    <Box
      component='nav'
      aria-label='بخش‌های فروشگاه'
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: INK,
        backgroundImage: `linear-gradient(180deg, ${INK_SOFT} 0%, ${INK} 38%)`,
        color: TEXT,
      }}
    >
      <Box
        sx={{
          px: 2.5,
          pt: 3,
          pb: 2.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <Avatar
          src={store.logoUrl ?? undefined}
          alt=''
          variant='rounded'
          sx={{
            width: 44,
            height: 44,
            bgcolor: '#4f46e5',
            color: '#fff',
            fontWeight: 800,
          }}
        >
          {store.logoUrl ? null : <StorefrontOutlined />}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            noWrap
            sx={{ fontWeight: 800, color: '#fff', lineHeight: 1.4 }}
          >
            {store.name}
          </Typography>
          <Typography variant='caption' sx={{ color: TEXT_MUTED }}>
            پنل مدیریت فروشگاه
          </Typography>
        </Box>
      </Box>
      <List
        sx={{
          px: 1.5,
          pt: 2,
          flex: 1,
          overflowY: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {nav.map((item) => {
          const active = item.match?.(pathname) ?? false;
          if (!item.children) {
            return (
              <ListItem key={item.href} disablePadding>
                <ListItemButton
                  component={Link}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  sx={rowSx(active)}
                >
                  <ListItemIcon>{item.icon}</ListItemIcon>
                  <ListItemText primary={item.label} />
                </ListItemButton>
              </ListItem>
            );
          }
          const expanded = open[item.label] ?? false;
          return (
            <ListItem key={item.href} disablePadding sx={{ display: 'block' }}>
              <ListItemButton
                onClick={() =>
                  setOpen((o) => ({ ...o, [item.label]: !expanded }))
                }
                aria-expanded={expanded}
                sx={rowSx(active)}
              >
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} />
                {expanded ? (
                  <ExpandLess fontSize='small' />
                ) : (
                  <ExpandMore fontSize='small' />
                )}
              </ListItemButton>
              <Collapse in={expanded} timeout='auto' unmountOnExit>
                <List disablePadding sx={{ pe: 1, ps: 3.5, pb: 0.5 }}>
                  {item.children.map((c) => {
                    const childActive = c.exact
                      ? pathname === c.href
                      : pathname.startsWith(c.href);
                    return (
                      <ListItem key={c.href} disablePadding>
                        <ListItemButton
                          component={Link}
                          href={c.href}
                          onClick={onNavigate}
                          aria-current={childActive ? 'page' : undefined}
                          sx={{
                            ...rowSx(childActive),
                            py: 0.75,
                            '&::before': undefined,
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 34 }}>
                            {c.icon}
                          </ListItemIcon>
                          <ListItemText
                            primary={c.label}
                            slotProps={{ primary: { sx: { fontSize: 14 } } }}
                          />
                        </ListItemButton>
                      </ListItem>
                    );
                  })}
                </List>
              </Collapse>
            </ListItem>
          );
        })}
      </List>
      <List sx={{ p: 1.5, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <ListItem disablePadding>
          <ListItemButton
            component={Link}
            href='/dashboard'
            onClick={onNavigate}
            sx={rowSx(false)}
          >
            <ListItemIcon>
              <ArrowBackRounded />
            </ListItemIcon>
            <ListItemText primary='همهٔ فروشگاه‌ها' />
          </ListItemButton>
        </ListItem>
      </List>
    </Box>
  );
}

/**
 * The store's admin area (`/dashboard/stores/<id>/…`): a dark sidebar with the store's sections, a top bar with product search and the
 * preview / live-store buttons, and the content on a soft background. On narrow screens the sidebar is a drawer behind the menu button.
 */
export default function StoreShell({
  store,
  liveUrl,
  children,
}: StoreShellProps) {
  const pathname = usePathname();
  const base = `/dashboard/stores/${encodeURIComponent(store.id)}`;
  const [drawer, setDrawer] = useState(false);
  const status = STATUS[store.status];
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        minHeight: 'calc(100vh - 64px)',
        bgcolor: '#f3f4fb',
      }}
    >
      <Box
        sx={{
          display: { xs: 'none', md: 'block' },
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          alignSelf: 'stretch',
          bgcolor: INK,
        }}
      >
        {/* sticky below the platform bar: the dark column runs the full page height, the menu itself stays in view while scrolling */}
        <Box
          sx={{
            position: 'sticky',
            top: 0,
            height: 'calc(100vh - 64px)',
            minHeight: 520,
          }}
        >
          <Sidebar store={store} base={base} pathname={pathname} />
        </Box>
      </Box>
      <Drawer
        anchor='right'
        open={drawer}
        onClose={() => setDrawer(false)}
        keepMounted={false}
        sx={{ display: { md: 'none' } }}
        slotProps={{
          paper: { sx: { width: SIDEBAR_WIDTH, maxWidth: '86vw' } },
        }}
      >
        <Sidebar
          store={store}
          base={base}
          pathname={pathname}
          onNavigate={() => setDrawer(false)}
        />
      </Drawer>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            bgcolor: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(8px)',
            borderBottom: '1px solid',
            borderColor: 'divider',
            px: { xs: 1.5, md: 3 },
            py: 1.25,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <IconButton
            aria-label='باز کردن منو'
            onClick={() => setDrawer(true)}
            sx={{ display: { md: 'none' } }}
          >
            <MenuRounded />
          </IconButton>
          <Box
            component='form'
            role='search'
            action={`${base}/products`}
            data-testid='store-search'
            sx={{ flex: 1, maxWidth: 520 }}
          >
            <TextField
              name='q'
              size='small'
              fullWidth
              placeholder='جستجو در محصولات'
              slotProps={{
                htmlInput: { 'aria-label': 'جستجو در محصولات', maxLength: 100 },
                input: {
                  startAdornment: (
                    <InputAdornment position='start'>
                      <SearchRounded fontSize='small' />
                    </InputAdornment>
                  ),
                  sx: { borderRadius: 3, bgcolor: '#f3f4fb' },
                },
              }}
            />
          </Box>
          <Box
            sx={{
              marginInlineStart: 'auto',
              display: 'flex',
              gap: 1,
              alignItems: 'center',
            }}
          >
            <Button
              component='a'
              href={`/preview/${encodeURIComponent(store.id)}`}
              target='_blank'
              rel='noopener'
              size='small'
              variant='outlined'
              endIcon={<OpenInNewRounded fontSize='small' />}
              sx={{
                borderRadius: 2.5,
                display: { xs: 'none', sm: 'inline-flex' },
              }}
            >
              پیش‌نمایش پیش‌نویس
            </Button>
            {liveUrl && (
              <Button
                component='a'
                href={liveUrl}
                target='_blank'
                rel='noopener'
                size='small'
                variant='contained'
                color='success'
                startIcon={<StorefrontOutlined fontSize='small' />}
                sx={{ borderRadius: 2.5 }}
              >
                مشاهدهٔ فروشگاه
              </Button>
            )}
          </Box>
        </Box>
        <Box
          data-testid='store-content'
          sx={{
            px: { xs: 2, md: 4 },
            py: { xs: 2.5, md: 4 },
            maxWidth: 1120,
            mx: 'auto',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              flexWrap: 'wrap',
              mb: 3,
            }}
          >
            <Typography variant='h5' component='h1' sx={{ fontWeight: 800 }}>
              {store.name}
            </Typography>
            <Chip
              size='small'
              label={status.label}
              color={status.color}
              variant={store.status === 'DRAFT' ? 'outlined' : 'filled'}
            />
          </Box>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
