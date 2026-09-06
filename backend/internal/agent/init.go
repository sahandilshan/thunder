// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package agent

import (
	"context"
	"net/http"

	"github.com/thunder-id/thunderid/internal/entity"
	"github.com/thunder-id/thunderid/internal/inboundclient"
	oupkg "github.com/thunder-id/thunderid/internal/ou"
	"github.com/thunder-id/thunderid/internal/resource"
	"github.com/thunder-id/thunderid/internal/role"
	serverconst "github.com/thunder-id/thunderid/internal/system/constants"
	declarativeresource "github.com/thunder-id/thunderid/internal/system/declarative_resource"
	"github.com/thunder-id/thunderid/internal/system/middleware"
)

// Initialize wires the agent service, registers HTTP routes and returns the service and exporter.
func Initialize(
	mux *http.ServeMux,
	entityService entity.EntityServiceInterface,
	inboundClientService inboundclient.InboundClientServiceInterface,
	ouService oupkg.OrganizationUnitServiceInterface,
	roleService role.RoleServiceInterface,
	resourceService resource.ResourceServiceInterface,
) (AgentServiceInterface, declarativeresource.ResourceExporter, error) {
	service := newAgentService(entityService, inboundClientService, ouService, roleService)
	// Injected before the declarative load rather than in servicemanager's second wiring phase: a
	// declarative agent may declare inbound access, which the loader turns into the resource server
	// the agent owns.
	service.SetResourceService(resourceService)

	storeMode := getAgentStoreMode()
	if storeMode == serverconst.StoreModeComposite || storeMode == serverconst.StoreModeDeclarative {
		if err := entityService.LoadDeclarativeResources(makeAgentDeclarativeConfig(service)); err != nil {
			return nil, nil, err
		}
		if err := inboundClientService.LoadDeclarativeResources(
			context.Background(), makeAgentInboundConfig(service)); err != nil {
			return nil, nil, err
		}
	}

	handler := newAgentHandler(service)
	registerRoutes(mux, handler)

	exporter := newAgentExporter(service)
	return service, exporter, nil
}

func registerRoutes(mux *http.ServeMux, h *agentHandler) {
	listOpts := middleware.CORSOptions{
		AllowedMethods:   []string{"GET", "POST"},
		AllowedHeaders:   middleware.DefaultAllowedHeaders,
		AllowCredentials: true,
		MaxAge:           600,
	}
	mux.HandleFunc(middleware.WithCORS("GET /agents", h.HandleAgentListRequest, listOpts))
	mux.HandleFunc(middleware.WithCORS("POST /agents", h.HandleAgentPostRequest, listOpts))
	mux.HandleFunc(middleware.WithCORS("OPTIONS /agents",
		func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}, listOpts))

	itemOpts := middleware.CORSOptions{
		AllowedMethods:   []string{"GET", "PUT", "DELETE"},
		AllowedHeaders:   middleware.DefaultAllowedHeaders,
		AllowCredentials: true,
		MaxAge:           600,
	}
	mux.HandleFunc(middleware.WithCORS("GET /agents/{id}", h.HandleAgentGetRequest, itemOpts))
	mux.HandleFunc(middleware.WithCORS("PUT /agents/{id}", h.HandleAgentPutRequest, itemOpts))
	mux.HandleFunc(middleware.WithCORS("DELETE /agents/{id}", h.HandleAgentDeleteRequest, itemOpts))
	mux.HandleFunc(middleware.WithCORS("OPTIONS /agents/",
		func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}, itemOpts))

	groupsOpts := middleware.CORSOptions{
		AllowedMethods:   []string{"GET"},
		AllowedHeaders:   middleware.DefaultAllowedHeaders,
		AllowCredentials: true,
		MaxAge:           600,
	}
	mux.HandleFunc(middleware.WithCORS("GET /agents/{id}/groups",
		h.HandleAgentGroupsRequest, groupsOpts))
	mux.HandleFunc(middleware.WithCORS("GET /agents/{id}/roles",
		h.HandleAgentRolesRequest, groupsOpts))

	rsOpts := middleware.CORSOptions{
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE"},
		AllowedHeaders:   middleware.DefaultAllowedHeaders,
		AllowCredentials: true,
		MaxAge:           600,
	}
	mux.HandleFunc(middleware.WithCORS("GET /agents/{id}/resource-server",
		h.HandleAgentInboundAccessGetRequest, rsOpts))
	mux.HandleFunc(middleware.WithCORS("POST /agents/{id}/resource-server",
		h.HandleAgentInboundAccessPostRequest, rsOpts))
	mux.HandleFunc(middleware.WithCORS("PUT /agents/{id}/resource-server",
		h.HandleAgentInboundAccessPutRequest, rsOpts))
	mux.HandleFunc(middleware.WithCORS("DELETE /agents/{id}/resource-server",
		h.HandleAgentInboundAccessDeleteRequest, rsOpts))
	mux.HandleFunc(middleware.WithCORS("OPTIONS /agents/{id}/resource-server",
		func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}, rsOpts))
}
