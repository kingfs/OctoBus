package supervisor

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

func validateConfigSchema(schemaPath string, config []byte) error {
	return validateJSONSchema(schemaPath, config, "config")
}

func validateSecretSchema(schemaPath string, secret []byte) error {
	return validateJSONSchema(schemaPath, secret, "secret")
}

func validateJSONSchema(schemaPath string, valueJSON []byte, kind string) error {
	if schemaPath == "" {
		return nil
	}
	var value any
	if err := json.Unmarshal(valueJSON, &value); err != nil {
		return fmt.Errorf("invalid %s JSON: %w", kind, err)
	}
	f, err := os.Open(schemaPath)
	if err != nil {
		return err
	}
	defer f.Close()
	schemaDoc, err := jsonschema.UnmarshalJSON(f)
	if err != nil {
		return fmt.Errorf("invalid %s schema: %w", kind, err)
	}
	compiler := jsonschema.NewCompiler()
	compiler.DefaultDraft(jsonschema.Draft2020)
	resource := kind + ".schema.json"
	if err := compiler.AddResource(resource, schemaDoc); err != nil {
		return fmt.Errorf("invalid %s schema: %w", kind, err)
	}
	schema, err := compiler.Compile(resource)
	if err != nil {
		return fmt.Errorf("invalid %s schema: %w", kind, err)
	}
	if err := schema.Validate(value); err != nil {
		return fmt.Errorf("%s does not match schema: %w", kind, err)
	}
	return nil
}
