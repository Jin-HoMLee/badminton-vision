#!/usr/bin/env python3
"""Export the MIT TrackNetV3 tracker checkpoint to browser-friendly ONNX.

The source checkout is supplied explicitly because it is not vendored into
this repository. This script exports the tracker only (not the optional V3
trajectory rectifier) with the browser contract [1, 9, H, W] -> [1, 3, H, W].
"""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import sys


def load_source_model(source):
    path = pathlib.Path(source) / 'model.py'
    spec = importlib.util.spec_from_file_location('tracknet_v3_source_model', path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.TrackNet


def state_dict(checkpoint):
    if isinstance(checkpoint, dict):
        for key in ('model', 'state_dict', 'model_state_dict'):
            if key in checkpoint and isinstance(checkpoint[key], dict):
                checkpoint = checkpoint[key]
                break
    if not isinstance(checkpoint, dict):
        raise ValueError('checkpoint does not contain a state dictionary')
    # DataParallel checkpoints may prefix every key with module.
    return {key.removeprefix('module.'): value for key, value in checkpoint.items()}


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, help='local qaz812345/TrackNetV3 checkout')
    parser.add_argument('--checkpoint', required=True, help='TrackNet_best.pt from the source release')
    parser.add_argument('--output', required=True, help='output .onnx path (normally artifacts/tracknet-v3.onnx)')
    parser.add_argument('--height', type=int, default=288)
    parser.add_argument('--width', type=int, default=512)
    parser.add_argument('--dynamic-spatial', action='store_true', help='allow H/W other than the trained 288x512 shape')
    args = parser.parse_args()
    if (args.height, args.width) != (288, 512) and not args.dynamic_spatial:
        raise SystemExit('V3 release weights are trained for 512x288; pass --dynamic-spatial only for an explicit shape experiment')

    import torch
    import onnx

    TrackNet = load_source_model(args.source)
    checkpoint = torch.load(args.checkpoint, map_location='cpu', weights_only=False)
    params = checkpoint.get('param_dict', {}) if isinstance(checkpoint, dict) else {}
    seq_len = int(params.get('seq_len', 3))
    bg_mode = params.get('bg_mode', '')
    if seq_len != 3 or bg_mode not in ('', None):
        raise SystemExit(f'checkpoint is not the browser-compatible V3 tracker variant: seq_len={seq_len}, bg_mode={bg_mode!r}')
    model = TrackNet(in_dim=9, out_dim=3)
    model.load_state_dict(state_dict(checkpoint), strict=True)
    model.eval()
    dummy = torch.zeros(1, 9, args.height, args.width, dtype=torch.float32)
    dynamic_axes = {'frames': {0: 'batch', 2: 'height', 3: 'width'}, 'heatmaps': {0: 'batch', 2: 'height', 3: 'width'}} if args.dynamic_spatial else None
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model, dummy, output, opset_version=17, do_constant_folding=True,
        input_names=['frames'], output_names=['heatmaps'], dynamic_axes=dynamic_axes,
    )
    onnx.checker.check_model(str(output))
    metadata = {
        'source': 'https://github.com/qaz812345/TrackNetV3',
        'source_license': 'MIT (repository LICENSE explicitly includes pretrained checkpoints)',
        'checkpoint': str(pathlib.Path(args.checkpoint).resolve()),
        'checkpoint_sha256': sha256(args.checkpoint),
        'input': [1, 9, args.height, args.width], 'output': [1, 3, args.height, args.width],
        'bg_mode': '', 'rectifier_exported': False, 'opset': 17,
    }
    output.with_suffix('.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(metadata, indent=2))


if __name__ == '__main__':
    main()
