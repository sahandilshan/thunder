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

import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import { useState, useEffect, useRef } from 'react';
import Layout from '../components/Layout';
import { decodeJwt } from '../services/jwtService';
import useAuth from '../hooks/useAuth';

type DecodedToken = {
    header: Record<string, object>;
    payload: Record<string, object>;
    signature: string;
}

const HomePage = () => {

    const isComponentReMount = useRef(false);
    const { token } = useAuth();

    const [ decodedToken, setDecodedToken ] = useState<DecodedToken | null>(null);

    useEffect(() => {
        // Prevent double API call due to React Strict Mode
        if (isComponentReMount.current) return;
        isComponentReMount.current = true;

        if (!token) {
            return;
        }

        setDecodedToken(decodeJwt(token));
    }, [token]);

    return (
        <Layout>
            <Box className="home-container">
                {token ? (
                    <Box className="token-container">
                        <Typography variant='h5' sx={{ mb: 3 }}>Auth Assertion:</Typography>
                        <pre style={{ margin: 0 }}>
                            <code>{token}</code>
                        </pre>
                        <Divider sx={{ my: 4 }} />
                        {decodedToken && (
                            <Box>
                                <Typography variant='h5' sx={{ mb: 3 }}>Decoded Assertion:</Typography>
                                <Box className="decoded-token-container">
                                    <Box className="decoded-token-section">
                                        <Typography variant='h6' sx={{ mt: 3, mb: 1 }}>Header:</Typography>
                                        <pre className="decoded-token">
                                            {JSON.stringify(decodedToken.header, null, 2)}
                                        </pre>
                                        <Typography variant='h6' sx={{ mt: 3, mb: 1 }}>Payload:</Typography>
                                        <pre className="decoded-token">
                                            {JSON.stringify(decodedToken.payload, null, 2)}
                                        </pre>
                                    </Box>
                                    <Box className="decoded-token-section" sx={{ mb: 6 }}>
                                        <Typography variant='h6' sx={{ mt: 3, mb: 1 }}>Signature:</Typography>
                                        <pre className="decoded-token">
                                            <code>{decodedToken.signature}</code>
                                        </pre>
                                    </Box>
                                </Box>
                            </Box>
                        )}
                    </Box>
                ) : (
                    <Typography>No auth assertion available. Please log in.</Typography>
                )}
            </Box>
        </Layout>
    );
};

export default HomePage;
