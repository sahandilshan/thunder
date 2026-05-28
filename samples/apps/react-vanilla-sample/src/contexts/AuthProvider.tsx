/*
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import AuthContext from './AuthContext';
import { getCurrentUserProfile, type UserProfile } from '../services/userProfileService';

/**
 * AuthProvider component to manage authentication state.
 * 
 * @param children - The children components to be wrapped by the AuthProvider.
 * @returns 
 */
const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('authToken'));
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  useEffect(() => {
    if (token === null) {
      sessionStorage.removeItem('authToken');
    } else {
      sessionStorage.setItem('authToken', token);
    }
  }, [token]);

  const refreshUserProfile = useCallback(async () => {
    if (!token) {
      setUserProfile(null);
      return null;
    }

    const tokenSnapshot = token;
    const profile = await getCurrentUserProfile(tokenSnapshot);

    if (tokenRef.current === tokenSnapshot) {
      setUserProfile(profile);
    }
    return profile;
  }, [token]);

  useEffect(() => {
    if (!token) {
      setUserProfile(null);
      return;
    }

    void refreshUserProfile().catch(() => {
      setUserProfile(null);
    });
  }, [refreshUserProfile, token]);

  const clearToken = useCallback(() => {
    setToken(null);
    setUserProfile(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, setToken, clearToken, userProfile, refreshUserProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;
