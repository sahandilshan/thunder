/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {Box, Container, Typography, useTheme} from '@wso2/oxygen-ui';
import {JSX, ReactNode} from 'react';
import useIsDarkMode from '../../hooks/useIsDarkMode';
import useScrollAnimation from '../../hooks/useScrollAnimation';
import {DocusaurusProductConfig} from '@site/docusaurus.product.config';

interface FeatureCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  index: number;
  isVisible: boolean;
  num: string | number;
}

/* ─── Highlight card ─────────────────────────────────────────────────────── */

function HighlightCard({icon, title, description, index, isVisible, num}: FeatureCardProps): JSX.Element {
  const isDark = useIsDarkMode();
  const theme = useTheme();

  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '16px',
        border: '1px solid',
        borderColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
        bgcolor: isDark ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.8)',
        p: {xs: 3, md: 3.5},
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(28px)',
        transitionProperty: 'opacity, transform, border-color, box-shadow',
        transitionDuration: '0.55s, 0.55s, 0.25s, 0.25s',
        transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
        transitionDelay: isVisible ? `${index * 0.07}s` : '0s',
        cursor: 'default',
        '&:hover': {
          borderColor: `rgba(${theme.vars?.palette.primary.main} / 0.42)`,
          boxShadow: isDark
            ? `0 0 0 1px rgba(${theme.vars?.palette.primary.main} / 0.18), 0 16px 40px rgba(0,0,0,0.28)`
            : `0 0 0 1px rgba(${theme.vars?.palette.primary.main} / 0.14), 0 12px 28px rgba(0,0,0,0.07)`,
        },
        /* Subtle noise texture */
        '&::after': {
          content: '""',
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          background: isDark
            ? `radial-gradient(ellipse at 0% 0%, rgba(${theme.vars?.palette.primary.main} / 0.08) 0%, transparent 55%)`
            : `radial-gradient(ellipse at 0% 0%, rgba(${theme.vars?.palette.primary.main} / 0.05) 0%, transparent 55%)`,
          pointerEvents: 'none',
        },
      }}
    >
      {/* Number badge */}
      <Typography
        sx={{
          position: 'absolute',
          top: 20,
          right: 20,
          fontFamily: 'var(--ifm-font-family-monospace, monospace)',
          fontSize: '0.68rem',
          letterSpacing: '0.06em',
          color: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)',
          fontWeight: 600,
          userSelect: 'none',
        }}
      >
        {num}
      </Typography>

      {/* Icon */}
      <Box
        sx={{
          width: 48,
          height: 48,
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `linear-gradient(135deg, rgba(${theme.vars?.palette.primary.main} / 0.18) 0%, rgba(${theme.vars?.palette.primary.main} / 0.08) 100%)`,
          color: 'primary.main',
          border: '1px solid',
          borderColor: `rgba(${theme.vars?.palette.primary.main} / 0.2)`,
          flexShrink: 0,
          transition: 'transform 0.25s ease, box-shadow 0.25s ease',
          'div:hover > &': {
            transform: 'scale(1.1)',
            boxShadow: `0 4px 16px rgba(${theme.vars?.palette.primary.main} / 0.28)`,
          },
        }}
      >
        {icon}
      </Box>

      <Box sx={{flex: 1}}>
        <Typography
          variant="h6"
          sx={{
            fontWeight: 700,
            mb: 1,
            fontSize: '1rem',
            letterSpacing: '-0.01em',
            color: 'text.primary',
            lineHeight: 1.3,
          }}
        >
          {title}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            fontSize: '0.875rem',
            lineHeight: 1.75,
            color: 'text.secondary',
          }}
        >
          {description}
        </Typography>
      </Box>
    </Box>
  );
}

/* ─── Feature data ───────────────────────────────────────────────────────── */

const highlights = [
  {
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="6" width="20" height="14" rx="3" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <circle cx="9" cy="13" r="1.5" />
        <circle cx="15" cy="13" r="1.5" />
        <path d="M9 17h6" />
      </svg>
    ),
    title: 'Native agent identity',
    description:
      'Engineered with native Agent ID and inherent agentic AI capabilities to secure end-to-end workflows among humans, agents, and resources, including full MCP and A2A authorization.',
  },
  {
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 10l1.5 1.5L15 8" />
        <circle cx="12" cy="13" r="1" />
      </svg>
    ),
    title: 'Post-quantum ready',
    description:
      'Built upon a Post-Quantum Cryptographic (PQC) foundation to be inherently resistant to "Harvest Now, Decrypt Later" and "Trust Now, Forge Later" attacks and crypto agility by design.',
  },
  {
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <circle cx="3" cy="6" r="2" />
        <circle cx="21" cy="6" r="2" />
        <circle cx="3" cy="18" r="2" />
        <circle cx="21" cy="18" r="2" />
        <path d="M5 6h4M15 6h4M5 18h4M15 18h4" />
        <path d="M4.5 7.5l6 3M19.5 7.5l-6 3M4.5 16.5l6-3M19.5 16.5l-6-3" />
      </svg>
    ),
    title: 'Decentralized identity integration',
    description:
      'Designed for integration with decentralized identity infrastructure, including digital wallets, verifiable credentials, DIDs, and trust registries, reducing integration complexity for developers.',
  },
  {
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M13 2L4.5 13.5H11L10 22L20.5 10H14L13 2z" />
      </svg>
    ),
    title: 'Lightweight, high-performant runtime',
    description:
      'Built for cloud-native delivery with a lightweight, high-performant, API-first runtime that integrates into modern CI/CD, GitOps, and containerized workflows.',
  },
];

/* ─── Capability row (bottom grid) ──────────────────────────────────────── */

function CapabilityCard({icon, title, description, index, isVisible}: CapabilityRowProps): JSX.Element {
  const isDark = useIsDarkMode();
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        p: {xs: 2.5, md: 3},
        borderRadius: '12px',
        border: '1px solid',
        borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        bgcolor: 'transparent',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
        transitionProperty: 'opacity, transform, border-color',
        transitionDuration: '0.5s, 0.5s, 0.2s',
        transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
        transitionDelay: isVisible ? `${index * 0.055}s` : '0s',
        '&:hover': {
          borderColor: `rgba(${theme.vars?.palette.primary.main} / 0.3)`,
          bgcolor: isDark
            ? `rgba(${theme.vars?.palette.primary.main} / 0.04)`
            : `rgba(${theme.vars?.palette.primary.main} / 0.02)`,
        },
      }}
    >
      <Box
        sx={{
          width: 38,
          height: 38,
          borderRadius: '9px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: isDark
            ? `rgba(${theme.vars?.palette.primary.main} / 0.1)`
            : `rgba(${theme.vars?.palette.primary.main} / 0.07)`,
          color: 'primary.main',
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Box>
        <Typography
          variant="subtitle2"
          sx={{fontWeight: 700, mb: 0.5, fontSize: '0.9rem', color: 'text.primary', letterSpacing: '-0.01em'}}
        >
          {title}
        </Typography>
        <Typography variant="body2" sx={{fontSize: '0.83rem', lineHeight: 1.65, color: 'text.secondary'}}>
          {description}
        </Typography>
      </Box>
    </Box>
  );
}

/* ─── Section divider ────────────────────────────────────────────────────── */

function SectionDivider({label}: {label: string}): JSX.Element {
  const isDark = useIsDarkMode();
  const theme = useTheme();

  return (
    <Box sx={{display: 'flex', alignItems: 'center', gap: 3, my: {xs: 6, md: 8}}}>
      <Box
        sx={{
          flex: 1,
          height: '1px',
          background: isDark
            ? `linear-gradient(90deg, transparent, rgba(${theme.vars?.palette.primary.main} / 0.25))`
            : `linear-gradient(90deg, transparent, rgba(${theme.vars?.palette.primary.main} / 0.2))`,
        }}
      />
      <Typography
        variant="h3"
        sx={{
          mt: 4,
          fontSize: {xs: '1rem', sm: '1.25rem', md: '2rem'},
          fontWeight: 800,
          letterSpacing: '-0.03em',
          color: 'text.primary',
          lineHeight: 1.15,
        }}
      >
        {label}
      </Typography>
      <Box
        sx={{
          flex: 1,
          height: '1px',
          background: isDark
            ? `linear-gradient(90deg, rgba(${theme.vars?.palette.primary.main} / 0.25), transparent)`
            : `linear-gradient(90deg, rgba(${theme.vars?.palette.primary.main} / 0.2), transparent)`,
        }}
      />
    </Box>
  );
}

const capabilities = [
  {
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="5" cy="6" r="2" />
        <circle cx="19" cy="6" r="2" />
        <circle cx="12" cy="18" r="2" />
        <path d="M7 6h10" />
        <path d="M6.5 7.5L12 16" />
        <path d="M17.5 7.5L12 16" />
      </svg>
    ),
    title: 'Every journey is a flow',
    description:
      'Model and orchestrate identity journeys as composable flows using a drag-and-drop visual flow builder.',
  },
  {
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
    title: 'API-first identity as code',
    description:
      'Every capability is accessible programmatically over a secure, modern RESTful API, enabling you to build, deploy, and manage identity as code.',
  },
  {
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.29 7 12 12 20.71 7" />
        <line x1="12" y1="22" x2="12" y2="12" />
      </svg>
    ),
    title: 'Developer-first SDKs',
    description:
      'Use drop-in UI components from pixel-perfect SDKs for React, Next.js, and more, and style with your own CSS.',
  },
  {
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="8" r="6" />
        <path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32" />
      </svg>
    ),
    title: 'Standards-first identity engine',
    description:
      'Built on proven open standards including OpenID Connect, OAuth2, SCIM, and SAML and designed to evolve with next-generation standards.',
  },
  {
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="14" width="20" height="8" rx="2" />
        <path d="M6 14v-2a6 6 0 0 1 12 0v2" />
        <line x1="6" y1="18" x2="6.01" y2="18" />
        <line x1="10" y1="18" x2="10.01" y2="18" />
      </svg>
    ),
    title: 'Agnostic infrastructure and deployment',
    description:
      'Deploy where your workloads live without infrastructure lock-in using a GitOps-driven approach and deployment artifacts for Kubernetes, Docker, and Helm.',
  },
  {
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
    title: 'Built for how you work',
    description:
      'Work your way, whether you are an app developer, IAM architect, or system admin. Your workflows, your default toolbox.',
  },
];

export default function ProductOverviewSection(): JSX.Element {
  const theme = useTheme();
  const {ref: titleRef, isVisible: titleVisible} = useScrollAnimation({threshold: 0.2});
  const {ref, isVisible} = useScrollAnimation({threshold: 0.05});
  const {siteConfig} = useDocusaurusContext();
  const productName = (siteConfig.customFields?.product as DocusaurusProductConfig).project.name;

  return (
    <Box sx={{pb: {xs: 8, lg: 12}}}>
      <Container maxWidth="lg" sx={{px: {xs: 2, sm: 4}}}>
        {/* Section heading */}
        <Box
          ref={titleRef}
          sx={{
            textAlign: 'center',
            mb: {xs: 6, md: 8},
            opacity: titleVisible ? 1 : 0,
            transform: titleVisible ? 'translateY(0)' : 'translateY(32px)',
            transition: 'opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <Typography
            variant="overline"
            sx={{
              display: 'block',
              fontSize: '0.7rem',
              letterSpacing: '0.18em',
              color: 'primary.main',
              fontWeight: 600,
              mb: 0.3,
            }}
          >
            BUILD DIFFERENT
          </Typography>

          <Typography
            variant="h3"
            sx={{
              mb: 2,
              fontSize: {xs: '1.75rem', sm: '2.25rem', md: '2.5rem'},
              fontWeight: 800,
              letterSpacing: '-0.03em',
              color: 'text.primary',
              lineHeight: 1.15,
            }}
          >
            What is{' '}
            <Box
              component="span"
              sx={{
                background: `linear-gradient(90deg, ${theme.vars?.palette.primary.dark} 0%, ${theme.vars?.palette.primary.main} 100%)`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {productName}?
            </Box>
          </Typography>
          <Typography
            variant="body1"
            sx={{
              maxWidth: '800px',
              mx: 'auto',
              fontSize: {xs: '0.95rem', sm: '1.05rem'},
              lineHeight: 1.75,
              color: 'text.secondary',
            }}
          >
            {productName} is an open source IAM stack built in Go, focused on open standards and designed to handle
            identity for humans, AI agents, and workloads with fully orchestratable identity flows.
          </Typography>
        </Box>

        {/* ── Highlight grid ── */}
        <Box ref={ref}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {xs: '1fr', sm: 'repeat(2, 1fr)'},
              gap: 2,
            }}
          >
            {highlights.map((item, index) => (
              <HighlightCard key={item.title} {...item} index={index} isVisible={isVisible} num={`0${index + 1}`} />
            ))}
          </Box>

          {/* ── Divider ── */}
          <Box
            sx={{
              opacity: isVisible ? 1 : 0,
              transition: 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.28s',
            }}
          >
            <SectionDivider label="Core capabilities" />
          </Box>

          {/* ── Capabilities grid ── */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)'},
              gap: 2,
            }}
          >
            {capabilities.map((item, index) => (
              <CapabilityCard key={item.title} {...item} index={index + 4} isVisible={isVisible} />
            ))}
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
